import { CompanionVoiceState } from '../shared/types';

const WORKER_URL = import.meta.env.DEV
  ? "http://localhost:8787"
  : "https://clicky-proxy.norbertb-consulting.workers.dev/";

let currentState: CompanionVoiceState = CompanionVoiceState.IDLE;

// --- Conversation History ---
type ClaudeMessage = {
  role: "user" | "assistant";
  content: string | Array<{ type: "text"; text: string } | { type: "image"; source: object }>;
};

let conversationHistory: ClaudeMessage[] = [];
let currentActiveGoal: string | null = null;

// --- Guidance State ---
interface GuidanceState {
  isGuidanceSessionActive: boolean;
  currentGoalDescription: string;
  currentStepNumber: number;
  lastPointedElementDataClickyId: string | null;
  lastResponseFromAI: string;
}

let currentGuidanceState: GuidanceState = {
  isGuidanceSessionActive: false,
  currentGoalDescription: "",
  currentStepNumber: 0,
  lastPointedElementDataClickyId: null,
  lastResponseFromAI: "",
};

// Cache for system prompt
let AI_SYSTEM_PROMPT: string | null = null;

async function getSystemPrompt(): Promise<string> {
  if (!AI_SYSTEM_PROMPT) {
    AI_SYSTEM_PROMPT = await fetch(chrome.runtime.getURL('AI_SYSTEM_PROMPT.md')).then(r => r.text());
  }
  return AI_SYSTEM_PROMPT;
}

chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId === 0 && currentActiveGoal !== null) {
    console.log(`[Clicky] Navigation starting. Keeping Buddy in thinking state.`);
    setState(CompanionVoiceState.PROCESSING, details.tabId);
  }
});

chrome.webNavigation.onCompleted.addListener((details) => {
  if (details.frameId === 0 && currentActiveGoal !== null) {
    console.log(`[Clicky] Navigation completed. Waiting 1.5s for DOM to settle...`);
    setState(CompanionVoiceState.PROCESSING, details.tabId); // Ensure 'Thinking' state on new page
    
    setTimeout(() => {
      console.log(`[Clicky] Resuming active goal: ${currentActiveGoal}`);
      chrome.tabs.sendMessage(details.tabId, { 
        type: 'RESUME_GOAL', 
        goal: currentActiveGoal,
        url: details.url
      }).catch(() => {});
    }, 1500);
  }
});

function setState(newState: CompanionVoiceState, tabId?: number) {
  currentState = newState;
  console.log(`State changed to: ${newState}`);
  
  const message = {
    type: 'VOICE_STATE_CHANGED',
    state: currentState
  };

  if (tabId) {
    chrome.tabs.sendMessage(tabId, message).catch(() => {});
  } else {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, message).catch(() => {});
      }
    });
  }
}

function startRecording(tabId: number) {
  if (currentState === CompanionVoiceState.IDLE) {
    setState(CompanionVoiceState.LISTENING, tabId);
    chrome.tabs.sendMessage(tabId, { type: 'START_RECORDING' }).catch(() => {});
  }
}

function stopRecording(tabId: number) {
  if (currentState === CompanionVoiceState.LISTENING) {
    setState(CompanionVoiceState.PROCESSING, tabId);
    chrome.tabs.sendMessage(tabId, { type: 'STOP_RECORDING' }).catch(() => {});
  }
}

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender) => {
  const tabId = sender.tab?.id;
  if (!tabId) return;

  if (message.type === 'RESET') {
    conversationHistory = [];
    currentGuidanceState = {
      isGuidanceSessionActive: false,
      currentGoalDescription: "",
      currentStepNumber: 0,
      lastPointedElementDataClickyId: null,
      lastResponseFromAI: "",
    };
    console.log(`Conversation history and guidance state reset`);
    return;
  } else if (message.type === 'GET_STATUS') {
    chrome.tabs.sendMessage(tabId, {
      type: 'VOICE_STATE_CHANGED',
      state: currentState
    }).catch(() => {});
    return;
  } else if (message.type === 'PTT_START') {
    startRecording(tabId);
  } else if (message.type === 'PTT_STOP') {
    stopRecording(tabId);
  } else if (message.type === 'PROCESS_AI_REQUEST') {
    handleAIRequest(tabId, message.payload);
  } else if (message.type === 'INTERACTION_COMPLETE') {
    setState(CompanionVoiceState.IDLE, tabId);
  } else if (message.type === 'ELEMENT_CLICKED') {
    if (currentGuidanceState.isGuidanceSessionActive) {
      console.log(`[Clicky] Element clicked: ${message.dataClickyId}`);
      currentGuidanceState.lastPointedElementDataClickyId = message.dataClickyId;
      currentGuidanceState.currentStepNumber++;

      // Trigger next AI turn with context about the click
      setState(CompanionVoiceState.PROCESSING, tabId);
      chrome.tabs.sendMessage(tabId, { type: 'COLLECT_ELEMENTS_AND_CONTINUE' }).catch(() => {});
    }
  }
});

async function captureVisibleTabScreenshot(tabId: number): Promise<string | null> {
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(undefined, {
      format: 'jpeg',
      quality: 60
    });

    // Strip the "data:image/jpeg;base64," prefix
    const base64String = dataUrl.replace(/^data:image\/jpeg;base64,/, '');
    return base64String;
  } catch (error) {
    // Silently fail on chrome:// pages or other restricted contexts
    return null;
  }
}

async function handleAIRequest(tabId: number, payload: { transcript: string, elements: any[] }) {
  console.log('Processing AI request via Claude API...', payload);
  
  try {
    if (!currentActiveGoal && payload.transcript && !payload.transcript.startsWith('The page has loaded.') && !payload.transcript.startsWith('I clicked it.')) {
      currentActiveGoal = payload.transcript;
      currentGuidanceState.isGuidanceSessionActive = true;
      currentGuidanceState.currentGoalDescription = payload.transcript;
      currentGuidanceState.currentStepNumber = 1;
      console.log(`[Clicky] Active goal set: ${currentActiveGoal}`);
    }

    const userPromptText = `User Transcript: "${payload.transcript}"

Available Interactive Elements on Screen:
${JSON.stringify(payload.elements, null, 2)}`.trim();

    // Capture screenshot
    const screenshot = await captureVisibleTabScreenshot(tabId);

    // Build message content
    let messageContent: ClaudeMessage['content'];
    if (screenshot) {
      messageContent = [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/jpeg',
            data: screenshot
          }
        },
        {
          type: 'text',
          text: userPromptText
        }
      ];
    } else {
      messageContent = userPromptText;
    }

    // Add user message to conversation history
    conversationHistory.push({ role: 'user', content: messageContent });

    const apiUrl = WORKER_URL;
    const systemPrompt = await getSystemPrompt();

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        system: systemPrompt,
        messages: conversationHistory,
        stream: true,
      })
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error('Claude API Error:', errorData);
      throw new Error(`Claude API error: ${response.statusText} - ${errorData}`);
    }

    setState(CompanionVoiceState.RESPONDING, tabId);

    const reader = response.body?.getReader();
    const decoder = new TextDecoder("utf-8");
    let fullResponseText = '';
    let buffer = '';

    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;
        const lines = buffer.split('\n');

        // Keep the last line in buffer (might be incomplete)
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.substring(6).trim();
            if (!dataStr || dataStr === '[DONE]') continue;
            try {
              const data = JSON.parse(dataStr);
              if (data.type === 'content_block_delta' && data.delta.type === 'text_delta') {
                const textChunk = data.delta.text;
                fullResponseText += textChunk;
                chrome.tabs.sendMessage(tabId, {
                  type: 'AI_CHUNK',
                  chunk: textChunk
                }).catch(() => {});
              }
            } catch (e) {
              if (dataStr) {
                console.error('Error parsing stream chunk:', dataStr, e);
              }
            }
          }
        }
      }
    }
    
    console.log('Finished stream from Claude:', fullResponseText);

    // Update guidance state with last AI response
    currentGuidanceState.lastResponseFromAI = fullResponseText;

    if (fullResponseText.includes('[GOAL_REACHED]')) {
      currentActiveGoal = null;
      // Reset guidance state
      currentGuidanceState.isGuidanceSessionActive = false;
      currentGuidanceState.currentGoalDescription = "";
      currentGuidanceState.currentStepNumber = 0;
      currentGuidanceState.lastPointedElementDataClickyId = null;
      console.log('[Clicky] Goal reached. Guidance session ended.');
    }

    // Add assistant response to conversation history
    conversationHistory.push({ role: 'assistant', content: fullResponseText });

    // Keep conversation history manageable (last 10 messages = 5 turns)
    if (conversationHistory.length > 10) {
      conversationHistory = conversationHistory.slice(-10);
    }
    
    chrome.tabs.sendMessage(tabId, { type: 'AI_STREAM_DONE' }).catch(() => {});

  } catch (error: any) {
    console.error('Error processing AI request:', error);
    setState(CompanionVoiceState.RESPONDING, tabId);
    
    chrome.tabs.sendMessage(tabId, {
      type: 'EXECUTE_AI_RESPONSE',
      responseText: error.message || 'Sorry, something went wrong while talking to Claude.'
    });
  }
}

// Listen for global command (hotkey)
chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-ptt') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id;
      if (!tabId) return;

      if (currentState === CompanionVoiceState.IDLE) {
        startRecording(tabId);
      } else {
        stopRecording(tabId);
      }
    });
  }
});

// Listen for clicks on the extension icon in the toolbar
chrome.action.onClicked.addListener((tab) => {
  const tabId = tab.id;
  if (!tabId) return;

  if (currentState === CompanionVoiceState.IDLE) {
    startRecording(tabId);
  } else {
    stopRecording(tabId);
  }
});

console.log('Background service worker initialized.');
