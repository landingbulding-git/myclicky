import { CompanionVoiceState } from '../shared/types';

let currentState: CompanionVoiceState = CompanionVoiceState.IDLE;

// --- Conversation History ---
type Message = { role: 'user' | 'model'; parts: { text: string }[] };
let messageHistory: Message[] = [];

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
    messageHistory = [];
    console.log(`Global history reset`);
    return;
  } else if (message.type === 'PTT_START') {
    startRecording(tabId);
  } else if (message.type === 'PTT_STOP') {
    stopRecording(tabId);
  } else if (message.type === 'PROCESS_AI_REQUEST') {
    handleAIRequest(tabId, message.payload);
  } else if (message.type === 'INTERACTION_COMPLETE') {
    setState(CompanionVoiceState.IDLE, tabId);
  }
});

const SYSTEM_PROMPT = `
You are Clicky, a friendly and helpful AI companion. The user sees you in their browser.

## Communication Rules
- Always write in lowercase, in a direct and warm style.
- Give short, 1-2 sentence answers.
- Avoid lists and markdown formatting in speech.

## Navigation Commands
Append technical commands for the plugin to the end of your response:
- **Pointing**: \`[POINT:x,y:label]\` - if you just want to show something.
- **Highlighting**: \`[CLICK:data-clicky-id:label]\` - to highlight the element the user needs to click. Explain what they need to do.
- **Waiting**: If the process consists of multiple steps, only explain ONE step at a time, highlight the element, and wait for the user to click it.

## Context Usage
Use the received HTML structure and knowledge from YouTube/FAQ to guide the user on exactly what they should click to learn and achieve their goal. Do not assume you are clicking it for them.
`;

async function handleAIRequest(tabId: number, payload: { transcript: string, elements: any[] }) {
  console.log('Processing AI request directly with Gemini API...', payload);
  
  try {
    // Get API Key from environment or storage
    let apiKey = (import.meta as any).env.VITE_GEMINI_API_KEY;
    
    if (!apiKey) {
      const storage = await chrome.storage.local.get('GEMINI_API_KEY');
      apiKey = storage.GEMINI_API_KEY;
    }
    
    if (!apiKey) {
      throw new Error('Gemini API Key not found. Please set VITE_GEMINI_API_KEY in your .env file or add it to chrome.storage.local under "GEMINI_API_KEY".');
    }

    // Capture highly compressed screenshot for cost-effective visual context
    let inlineDataPart = null;
    try {
      const screenshotDataUrl = await chrome.tabs.captureVisibleTab(
        chrome.windows.WINDOW_ID_CURRENT, 
        { format: 'jpeg', quality: 10 }
      );
      
      if (screenshotDataUrl) {
        // Extract mime type and base64 data from data URI: "data:image/jpeg;base64,/9j/4AAQSkZJRg..."
        const match = screenshotDataUrl.match(/^data:(image\/[a-z]+);base64,(.*)$/);
        if (match && match.length === 3) {
           inlineDataPart = {
             inlineData: {
               mimeType: match[1],
               data: match[2]
             }
           };
           console.log(`Screenshot captured and compressed for AI (length: ${match[2].length} chars)`);
        }
      }
    } catch (e) {
      console.warn("Failed to capture screenshot:", e);
    }

    // Prepare the prompt
    const userPromptText = `
User Transcript: "${payload.transcript}"

Available Interactive Elements on Screen:
${JSON.stringify(payload.elements, null, 2)}
    `.trim();
    
    const parts: any[] = [{ text: userPromptText }];
    if (inlineDataPart) {
        parts.push(inlineDataPart);
    }
    
    const currentUserMessage: Message = { role: 'user', parts: parts };
    
    const contents = [...messageHistory, currentUserMessage];

    // Call Gemini API directly (Google AI, not Vertex)
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: contents,
        system_instruction: {
          parts: [{ text: SYSTEM_PROMPT }]
        }
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('Gemini API Error:', errorData);
      if (response.status === 429) {
        throw new Error('Too many requests. Your Gemini API quota might be exhausted.');
      }
      throw new Error(`Gemini API error: ${response.statusText}`);
    }

    const data = await response.json();
    const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    console.log('Received response from Gemini:', responseText);
    
    // Update history
    messageHistory.push({ role: 'user', parts: [{ text: `User Transcript: "${payload.transcript}"` }] }); // Store only transcript to save tokens
    messageHistory.push({ role: 'model', parts: [{ text: responseText }] });
    
    // Memory Limit: 10 items (5 turns)
    if (messageHistory.length > 10) {
      messageHistory = messageHistory.slice(-10);
    }
    
    setState(CompanionVoiceState.RESPONDING, tabId);

    // 3. Send AI response back to content script for execution and TTS
    chrome.tabs.sendMessage(tabId, {
      type: 'EXECUTE_AI_RESPONSE',
      responseText: responseText
    });

  } catch (error: any) {
    console.error('Error processing AI request:', error);
    setState(CompanionVoiceState.RESPONDING, tabId);
    
    // Provide user feedback on error
    chrome.tabs.sendMessage(tabId, {
      type: 'EXECUTE_AI_RESPONSE',
      responseText: error.message || 'Sorry, something went wrong while talking to Gemini.'
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
