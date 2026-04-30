export enum CompanionVoiceState {
  IDLE = 'IDLE',
  LISTENING = 'LISTENING',
  PROCESSING = 'PROCESSING',
  RESPONDING = 'RESPONDING',
}

export type VoiceStateMessage = {
  type: 'VOICE_STATE_CHANGED';
  state: CompanionVoiceState;
};

export type PTTMessage = {
  type: 'PTT_START' | 'PTT_STOP';
};
