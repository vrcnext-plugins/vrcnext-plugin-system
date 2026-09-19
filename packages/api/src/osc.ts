/**
 * OSC through VRCNext.
 *
 * VRCNext owns the sockets — it sends to `127.0.0.1:9000`, listens on `9001`, and advertises an
 * extra receive port over OSCQuery. Plugins therefore do not open sockets of their own; they ask
 * VRCNext to send, and subscribe to what it receives. That keeps a single OSCQuery advertisement
 * and avoids fighting VRChat over port 9001.
 *
 * Verified against VRCNext's `oscSend` / `oscSendRaw` actions and `oscParams` / `oscAvatarParams`
 * events.
 */

export const OSC_VALUE_KINDS = ['bool', 'int', 'float'] as const;
export type OscValueKind = (typeof OSC_VALUE_KINDS)[number];

/** Value union matching the kinds VRCNext's OSC bridge accepts. */
export type OscValue = boolean | number;

export interface OscParamEvent {
  /** Parameter name without the `/avatar/parameters/` prefix. */
  readonly name: string;
  readonly value: OscValue;
  readonly kind: string;
}

export interface OscAvatarChangeEvent {
  readonly avatarId: string;
  readonly parameters: readonly {
    readonly name: string;
    readonly type: string;
    readonly hasInput: boolean;
    readonly hasOutput: boolean;
  }[];
}

export interface OscApi {
  /** Starts VRCNext's OSC service if it is not already running. */
  connect(): void;
  disconnect(): void;

  /** Sends to `/avatar/parameters/<name>`. */
  send(name: string, kind: 'bool', value: boolean): void;
  send(name: string, kind: 'int' | 'float', value: number): void;

  /** Sends to an arbitrary OSC address, e.g. `/chatbox/input`. */
  sendRaw(address: string, kind: 'bool', value: boolean): void;
  sendRaw(address: string, kind: 'int' | 'float', value: number): void;

  /** Fires for every avatar parameter VRCNext receives. */
  onParam(listener: (event: OscParamEvent) => void): () => void;

  /** Fires when VRChat reports an avatar change, with the new parameter list. */
  onAvatarChange(listener: (event: OscAvatarChangeEvent) => void): () => void;
}
