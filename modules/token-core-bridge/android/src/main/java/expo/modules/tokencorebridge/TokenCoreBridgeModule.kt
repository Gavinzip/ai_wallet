package expo.modules.tokencorebridge

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class TokenCoreBridgeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("TokenCoreBridge")

    Function("isAvailable") {
      false
    }

    Function("getDefaultFileDir") {
      throw IllegalStateException("Token Core Android bridge is not wired yet.")
    }

    AsyncFunction("callTcxApi") { _: String ->
      throw IllegalStateException("Token Core Android bridge is not wired yet.")
    }
  }
}
