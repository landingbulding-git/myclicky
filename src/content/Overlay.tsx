import { useEffect, useState } from 'react';
import { CompanionVoiceState } from '../shared/types';

export const Overlay = () => {
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [voiceState, setVoiceState] = useState<CompanionVoiceState>(CompanionVoiceState.IDLE);
  const [bubbleText, setBubbleText] = useState('');

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setPosition({ x: e.clientX, y: e.clientY });
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  useEffect(() => {
    const messageListener = (message: any) => {
      if (message.type === 'VOICE_STATE_CHANGED') {
        setVoiceState(message.state);
        if (message.state === CompanionVoiceState.LISTENING) setBubbleText('Listening...');
        else if (message.state === CompanionVoiceState.PROCESSING) setBubbleText('Thinking...');
        else if (message.state === CompanionVoiceState.RESPONDING) setBubbleText('Here we go.');
        else setBubbleText('');
      } else if (message.type === 'SHOW_BUBBLE_TEXT') {
        setBubbleText(message.text);
      }
    };

    chrome.runtime.onMessage.addListener(messageListener);
    return () => chrome.runtime.onMessage.removeListener(messageListener);
  }, []);

  // Determine styles based on state
  const isActive = voiceState !== CompanionVoiceState.IDLE;
  let dotColor = 'rgba(128, 128, 128, 0.5)';
  
  if (voiceState === CompanionVoiceState.LISTENING) dotColor = '#ef4444'; // Red
  if (voiceState === CompanionVoiceState.PROCESSING) dotColor = '#eab308'; // Yellow
  if (voiceState === CompanionVoiceState.RESPONDING) dotColor = '#22c55e'; // Green

  if (!isActive && !bubbleText) return null;

  return (
    <div 
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        pointerEvents: 'none',
        zIndex: 2147483647 // Max z-index
      }}
    >
      {/* Buddy Cursor Dot */}
      <div
        style={{
          position: 'absolute',
          left: position.x + 15, // Offset from actual cursor
          top: position.y + 15,
          width: '12px',
          height: '12px',
          borderRadius: '50%',
          backgroundColor: dotColor,
          boxShadow: '0 0 8px rgba(0,0,0,0.3)',
          transition: 'background-color 0.3s ease',
        }}
      />

      {/* Bubble Text */}
      {bubbleText && (
        <div
          style={{
            position: 'absolute',
            left: position.x + 35,
            top: position.y + 10,
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            color: 'white',
            padding: '6px 12px',
            borderRadius: '16px',
            fontSize: '13px',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            fontWeight: 500,
            whiteSpace: 'nowrap',
            boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
            opacity: 0.9,
          }}
        >
          {bubbleText}
        </div>
      )}
    </div>
  );
};
