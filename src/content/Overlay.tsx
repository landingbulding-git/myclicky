import { useEffect, useState } from 'react';
import { CompanionVoiceState } from '../shared/types';

export const Overlay = () => {
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [voiceState, setVoiceState] = useState<CompanionVoiceState>(CompanionVoiceState.IDLE);
  const [bubbleText, setBubbleText] = useState('');
  
  // Animation state
  const [animations, setAnimations] = useState<{ id: number; x: number; y: number }[]>([]);
  const [isInteractionLocked, setIsInteractionLocked] = useState(false);
  const [targetPosition, setTargetPosition] = useState<{ x: number; y: number } | null>(null);

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

  // Listen for window messages (from index.tsx)
  useEffect(() => {
    const windowMessageListener = (event: MessageEvent) => {
      if (event.data && event.data.type === 'TRIGGER_CLICK_ANIM') {
        const id = Date.now();
        setAnimations((prev) => [...prev, { id, x: event.data.x, y: event.data.y }]);
        setIsInteractionLocked(true);
        setTargetPosition({ x: event.data.x, y: event.data.y });

        setTimeout(() => {
          setAnimations((prev) => prev.filter(anim => anim.id !== id));
          setIsInteractionLocked(false);
          setTargetPosition(null);
        }, 1000); // 1 second animation
      }
    };

    window.addEventListener('message', windowMessageListener);
    return () => window.removeEventListener('message', windowMessageListener);
  }, []);

  // Determine styles based on state
  const isActive = voiceState !== CompanionVoiceState.IDLE || isInteractionLocked;
  let dotColor = 'rgba(128, 128, 128, 0.5)';
  
  if (isInteractionLocked) dotColor = '#3b82f6'; // Blue when highlighting/animating
  else if (voiceState === CompanionVoiceState.LISTENING) dotColor = '#ef4444'; // Red
  else if (voiceState === CompanionVoiceState.PROCESSING) dotColor = '#eab308'; // Yellow
  else if (voiceState === CompanionVoiceState.RESPONDING) dotColor = '#22c55e'; // Green

  if (!isActive && !bubbleText && animations.length === 0) return null;

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
          left: isInteractionLocked && targetPosition ? targetPosition.x : position.x + 15, // Offset from actual cursor
          top: isInteractionLocked && targetPosition ? targetPosition.y : position.y + 15,
          width: '12px',
          height: '12px',
          borderRadius: '50%',
          backgroundColor: dotColor,
          boxShadow: isInteractionLocked ? '0 0 15px 5px rgba(59, 130, 246, 0.6)' : '0 0 8px rgba(0,0,0,0.3)',
          transition: isInteractionLocked 
            ? 'left 0.8s cubic-bezier(0.33, 1, 0.68, 1), top 0.8s cubic-bezier(0.32, 0, 0.67, 0), background-color 0.3s ease, box-shadow 0.3s ease'
            : 'left 0.1s linear, top 0.1s linear, background-color 0.3s ease, box-shadow 0.3s ease',
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

      {/* Floating Click Animations */}
      {animations.map(anim => (
        <div
          key={anim.id}
          style={{
            position: 'absolute',
            left: anim.x,
            top: anim.y,
            transform: 'translate(-50%, -100%)',
            backgroundColor: '#3b82f6',
            color: 'white',
            padding: '4px 10px',
            borderRadius: '12px',
            fontSize: '12px',
            fontWeight: 'bold',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            boxShadow: '0 4px 12px rgba(59, 130, 246, 0.4)',
            animation: 'floatUpFade 1s cubic-bezier(0.16, 1, 0.3, 1) forwards',
            pointerEvents: 'none'
          }}
        >
          Klikk!
        </div>
      ))}
    </div>
  );
};
