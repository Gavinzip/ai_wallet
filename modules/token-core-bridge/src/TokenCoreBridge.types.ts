export type TokenCoreBridgeModuleShape = {
  getDefaultFileDir: () => string;
  isAvailable: () => boolean;
  callTcxApi: (hexPayload: string) => Promise<string>;
};
