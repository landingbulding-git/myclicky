# Operational Logic and Data Flow

## Push-to-Talk (PTT) Process
1. **Shortcut**: The user presses the shortcut key (Control+Option).
2. **Start**: Microphone recording starts, similar to `BuddyDictationManager`.
3. **Stop**: Upon release, the extension:
   - Takes a low-resolution JPEG screenshot.
   - Collects a list of interactive elements in the current viewport (ID, text, type).
4. **Sending**: Data is sent directly to the Gemini API (Google AI) from the background script using the `VITE_GEMINI_API_KEY`.

## Hybrid Analysis Rules
- The list of HTML elements ensures accurate identification.
- The AI should prefer using HTML IDs over coordinates for clicks.
- Screenshots are temporarily disabled to optimize performance and token usage.
