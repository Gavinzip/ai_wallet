import { NativeModule, requireOptionalNativeModule } from "expo";

declare class TokenCoreBridgeModule extends NativeModule {
  getDefaultFileDir(): string;
  isAvailable(): boolean;
  callTcxApi(hexPayload: string): Promise<string>;
}

export default requireOptionalNativeModule<TokenCoreBridgeModule>("TokenCoreBridge");
