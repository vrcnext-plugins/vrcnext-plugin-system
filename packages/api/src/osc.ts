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
 *
 * > [!NOTE]
 * > **OSC is Windows-only in VRCNext itself.** `MessageRouter.IsWindowsOnlyAction` drops any
 * > action whose name starts with `osc` followed by an uppercase letter, so `oscSend`,
 * > `oscSendRaw`, `oscConnect` and `oscDisconnect` never reach the backend on Linux. VRCNext's
 * > own OSC Tool tab is hidden there for the same reason.
 * >
 * > The host falls back to the bridge's `osc` service, which holds the same sockets VRCNext
 * > would have: VRChat listens on 9000 and sends to 9001 either way. Nothing below changes
 * > shape, and a plugin cannot tell which path carried a message. What it still must check is
 * > {@link OscApi.available}, which is false on Linux when the bridge is not connected or is
 * > older than the service.
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
  /**
   * Whether OSC can be carried at all: by VRCNext on Windows, or by the bridge's `osc` service
   * elsewhere. False on Linux with no bridge connected, or with one predating the service.
   *
   * Every method below is a no-op (logged, not silent) when this is `false`. It can change
   * while a plugin runs, because the bridge can connect and drop.
   */
  readonly available: boolean;

  /** Starts OSC if it is not already running: VRCNext's service, or the bridge's receive port. */
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
