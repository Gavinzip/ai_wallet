import { NativeModule, registerWebModule } from "expo";

class TokenCoreBridgeModule extends NativeModule {
  getDefaultFileDir() {
    throw new Error("Token Core native bridge is unavailable on web.");
  }

  isAvailable() {
    return false;
  }

  async callTcxApi(_hexPayload: string): Promise<string> {
    throw new Error("Token Core native bridge is unavailable on web.");
  }
}

export default registerWebModule(TokenCoreBridgeModule, "TokenCoreBridge");
