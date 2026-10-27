// The active text editing session, registered by the shared TextEditor while it is mounted.
export type FormatCommand =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strike'
  | 'link'
  | 'bullets'
  | 'numbers'
  | 'color'
  | 'highlight'
  | 'clear';

export interface TextFormatState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  bullets: boolean;
  numbers: boolean;
  link: string | null;
}

export const EMPTY_FORMAT_STATE: TextFormatState = {
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  bullets: false,
  numbers: false,
  link: null,
};

export interface TextSession {
  id: string;
  field: string;
  /** Writes pending text to the doc now. */
  flush(): void;
  exec(cmd: FormatCommand, value?: string): void;
  /** Focuses the editor and inserts text at the caret (keys typed before focus landed). */
  insertText(text: string): void;
  state(): TextFormatState;
}
