declare function require(path: string): number;
declare module '*.js' {
  export const BridgeClient: any;
  export const ClockSync: any;
}
