import { createRoot } from 'react-dom/client';
import { Overlay } from './Overlay';

// --- Debugging Help ---
console.log('%c[Clicky] Content script loading...', 'color: #00ff00; font-weight: bold;');

function showDebugBanner() {
  const banner = document.createElement('div');
  banner.textContent = 'Clicky Copy Loaded (Press Ctrl+Alt+Space)';
  Object.assign(banner.style, {
    position: 'fixed',
    top: '0',
    left: '50%',
    transform: 'translateX(-50%)',
    backgroundColor: '#000',
    color: '#fff',
    padding: '5px 15px',
    fontSize: '12px',
    zIndex: '2147483647',
    borderBottomLeftRadius: '10px',
    borderBottomRightRadius: '10px',
    pointerEvents: 'none',
    opacity: '0.7'
  });
  document.body.appendChild(banner);
  setTimeout(() => banner.remove(), 5000); // Remove after 5s
}

// --- React App Injection via Shadow DOM ---
function injectReactApp() {
  try {
    console.log('[Clicky] Injecting React UI...');
    const host = document.createElement('div');
    host.id = 'clicky-extension-root';
    Object.assign(host.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '100vw',
      height: '100vh',
      pointerEvents: 'none',
      zIndex: '2147483647',
    });
    
    document.body.appendChild(host);

    const shadowRoot = host.attachShadow({ mode: 'open' });
    
    // Inject Global Styles for Shadow DOM and Document
    const style = document.createElement('style');
    style.textContent = `
      @keyframes pulse-border {
        0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7); }
        70% { box-shadow: 0 0 0 10px rgba(239, 68, 68, 0); }
        100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
      }
      .clicky-active-target {
        outline: 4px solid #ef4444 !important;
        animation: pulse-border 2s infinite !important;
        transition: outline 0.3s ease-in-out !important;
      }
      @keyframes floatUpFade {
        0% { opacity: 1; transform: translateY(0); }
        100% { opacity: 0; transform: translateY(-30px); }
      }
    `;
    document.head.appendChild(style.cloneNode(true)); // Add to main doc for highlighted elements
    shadowRoot.appendChild(style); // Add to shadow root for React components

    const appContainer = document.createElement('div');
    shadowRoot.appendChild(appContainer);

    const root = createRoot(appContainer);
    root.render(<Overlay />);
    console.log('[Clicky] React UI injected successfully.');
    showDebugBanner();
  } catch (error) {
    console.error('[Clicky] Failed to inject React UI:', error);
  }
}

// Ensure DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectReactApp);
} else {
  injectReactApp();
}

// --- PTT Logic ---
let isPTTActive = false;

window.addEventListener('keydown', (event) => {
  // Debug key logs
  if (event.ctrlKey || event.altKey) {
    console.log('[Clicky] Keydown detected:', event.code, 'Ctrl:', event.ctrlKey, 'Alt:', event.altKey);
  }

  if (event.ctrlKey && event.altKey && event.code === 'Space') {
    if (!isPTTActive) {
      isPTTActive = true;
      console.log('[Clicky] PTT Start');
      // Clear previous highlights
      document.querySelectorAll('.clicky-active-target').forEach(el => {
        el.classList.remove('clicky-active-target');
      });
      chrome.runtime.sendMessage({ type: 'PTT_START' });
    }
    event.preventDefault();
    event.stopPropagation();
  }
}, true); // Use capture to get ahead of other listeners

window.addEventListener('keyup', (event) => {
  if (event.code === 'Space' || !event.ctrlKey || !event.altKey) {
    if (isPTTActive) {
      isPTTActive = false;
      console.log('[Clicky] PTT Stop');
      chrome.runtime.sendMessage({ type: 'PTT_STOP' });
    }
  }
}, true);

// --- DOM Annotation Logic ---
function isElementInViewport(el: Element) {
  const rect = el.getBoundingClientRect();
  return (
    rect.top >= 0 &&
    rect.left >= 0 &&
    rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
    rect.right <= (window.innerWidth || document.documentElement.clientWidth)
  );
}

function annotateAndCollectElements() {
  console.log('Annotating interactive elements...');
  // Clean up previous annotations
  document.querySelectorAll('[data-clicky-id]').forEach(el => {
    el.removeAttribute('data-clicky-id');
  });

  const interactiveSelectors = 'button, a, input, [role="button"], [onclick]';
  const elements = Array.from(document.querySelectorAll(interactiveSelectors));
  
  let idCounter = 1;
  const collected = [];

  for (const el of elements) {
    if (collected.length >= 100) break; // Limit to 100 elements to avoid hitting AI token limits
    if (isElementInViewport(el)) {
      const clickyId = `el-${idCounter++}`;
      el.setAttribute('data-clicky-id', clickyId);
      collected.push({
        id: clickyId,
        text: el.textContent?.trim().substring(0, 50) || (el as HTMLInputElement).value || '',
        tag: el.tagName
      });
    }
  }

  return collected;
}

// --- Interaction Logic ---
function highlightElement(clickyId: string) {
  const el = document.querySelector(`[data-clicky-id="${clickyId}"]`) as HTMLElement;
  if (!el) {
    console.error(`Element with clicky-id ${clickyId} not found.`);
    return;
  }

  // Apply persistent highlight
  el.classList.add('clicky-active-target');
  console.log(`Highlighting element ${clickyId} for the user to click`);
  
  // Calculate center of element for the animation
  const rect = el.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const topY = rect.top;

  // Trigger floating click animation in the React overlay
  window.postMessage({ 
    type: 'TRIGGER_CLICK_ANIM', 
    x: centerX, 
    y: topY 
  }, '*');
}

// --- Speech Recognition (STT) Setup ---
const SpeechRecognitionAPI = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
let recognition: any = null;
let currentTranscript = '';
let currentInterimTranscript = ''; // Add state for interim

if (SpeechRecognitionAPI) {
  recognition = new SpeechRecognitionAPI();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US'; // Set to English
  
  recognition.onresult = (event: any) => {
    let interimTranscript = '';
    let finalTranscript = '';

    for (let i = event.resultIndex; i < event.results.length; ++i) {
      if (event.results[i].isFinal) {
        finalTranscript += event.results[i][0].transcript;
      } else {
        interimTranscript += event.results[i][0].transcript;
      }
    }
    
    if (finalTranscript) {
      currentTranscript += finalTranscript + ' ';
    }
    currentInterimTranscript = interimTranscript; // Save interim
    
    // Send interim text to overlay for visual feedback
    const displayText = finalTranscript || interimTranscript;
    if (displayText) {
      window.postMessage({ type: 'SHOW_BUBBLE_TEXT', text: displayText }, '*');
    }
  };

  recognition.onerror = (event: any) => {
    console.error('Speech recognition error:', event.error);
    if (event.error === 'not-allowed') {
      window.postMessage({ type: 'SHOW_BUBBLE_TEXT', text: 'Microphone access denied!' }, '*');
    }
  };
}

let aiResponseBuffer = '';
let fullCleanDisplayText = '';

function speakSentence(text: string) {
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  window.speechSynthesis.speak(utterance);
}

function checkSpeechFinished() {
  if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
    setTimeout(checkSpeechFinished, 500);
  } else {
    chrome.runtime.sendMessage({ type: 'INTERACTION_COMPLETE' });
  }
}

// --- Background Message Listener ---
chrome.runtime.onMessage.addListener(async (message) => {
  if (message.type === 'START_RECORDING') {
    currentTranscript = '';
    currentInterimTranscript = ''; // Reset interim
    window.speechSynthesis.cancel(); // Interrupt any ongoing TTS
    aiResponseBuffer = '';
    fullCleanDisplayText = '';
    if (recognition) {
      try {
        recognition.start();
        console.log('STT recording started...');
      } catch (e) {
        console.error('Failed to start STT:', e);
      }
    }
  } else if (message.type === 'STOP_RECORDING') {
    if (recognition) {
      recognition.stop();
      console.log('STT recording stopped.');
    }
    
    const elements = annotateAndCollectElements();
    const finalFullTranscript = (currentTranscript + ' ' + currentInterimTranscript).trim();
    
    console.log('Collected elements for AI:', elements);
    console.log('Final Transcript:', finalFullTranscript);
    
    if (!finalFullTranscript) {
       console.log('No transcript captured. Aborting AI request.');
       window.postMessage({ type: 'SHOW_BUBBLE_TEXT', text: "I didn't hear anything." }, '*');
       setTimeout(() => {
         chrome.runtime.sendMessage({ type: 'INTERACTION_COMPLETE' });
       }, 2000);
       return;
    }
    
    // Send the bundle to the background script
    chrome.runtime.sendMessage({
      type: 'PROCESS_AI_REQUEST',
      payload: {
        transcript: finalFullTranscript,
        elements: elements
      }
    });
  } else if (message.type === 'EXECUTE_CLICK') {
    highlightElement(message.clickyId);
  } else if (message.type === 'EXECUTE_AI_RESPONSE') {
    // Fallback for non-streaming
    aiResponseBuffer = message.responseText;
    chrome.runtime.sendMessage({ type: 'AI_STREAM_DONE' }); // trigger processing
  } else if (message.type === 'AI_CHUNK') {
    aiResponseBuffer += message.chunk;
    
    // Extract Clicks
    const clickRegex = /\[CLICK:(el-\d+)(?::(.*?))?\]/g;
    let match;
    while ((match = clickRegex.exec(aiResponseBuffer)) !== null) {
      highlightElement(match[1]);
      aiResponseBuffer = aiResponseBuffer.replace(match[0], '');
      clickRegex.lastIndex = 0;
    }

    // Extract Points (Bonus implementation)
    const pointRegex = /\[POINT:(\d+),(\d+)(?::(.*?))?\]/g;
    while ((match = pointRegex.exec(aiResponseBuffer)) !== null) {
      aiResponseBuffer = aiResponseBuffer.replace(match[0], '');
      pointRegex.lastIndex = 0;
    }

    // Find safe text (everything before the last unclosed '[')
    let safeText = aiResponseBuffer;
    const lastOpen = aiResponseBuffer.lastIndexOf('[');
    const lastClose = aiResponseBuffer.lastIndexOf(']');
    if (lastOpen > lastClose) {
      safeText = aiResponseBuffer.substring(0, lastOpen);
    }

    // Extract sentences from safeText
    const sentenceRegex = /([^\.!?]+[.!?]+)(?=\s|$)/g;
    let sentenceMatch;
    let lastIndexProcessed = 0;

    while ((sentenceMatch = sentenceRegex.exec(safeText)) !== null) {
      const sentence = sentenceMatch[1].trim();
      if (sentence) {
        speakSentence(sentence);
      }
      lastIndexProcessed = sentenceMatch.index + sentenceMatch[1].length;
    }

    // Remove spoken sentences from buffer
    if (lastIndexProcessed > 0) {
      const spokenPart = safeText.substring(0, lastIndexProcessed);
      aiResponseBuffer = aiResponseBuffer.substring(lastIndexProcessed);
      fullCleanDisplayText += spokenPart;
    }
    
    // Update display with fullCleanDisplayText + safeText left
    let currentDisplay = fullCleanDisplayText + (lastOpen > lastClose ? aiResponseBuffer.substring(0, lastOpen) : aiResponseBuffer);
    window.postMessage({ type: 'SHOW_BUBBLE_TEXT', text: currentDisplay.trim() }, '*');

  } else if (message.type === 'AI_STREAM_DONE') {
    let finalClean = aiResponseBuffer.replace(/\[.*?\]/g, '').trim();
    if (finalClean) {
      speakSentence(finalClean);
      fullCleanDisplayText += finalClean;
      window.postMessage({ type: 'SHOW_BUBBLE_TEXT', text: fullCleanDisplayText.trim() }, '*');
    }
    aiResponseBuffer = '';
    checkSpeechFinished();
  }
});
