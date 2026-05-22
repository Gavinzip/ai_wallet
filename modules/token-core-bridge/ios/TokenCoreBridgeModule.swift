import ExpoModulesCore
import TokenCoreX

public class TokenCoreBridgeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("TokenCoreBridge")

    Function("isAvailable") {
      true
    }

    Function("getDefaultFileDir") {
      try Self.defaultFileDir()
    }

    AsyncFunction("callTcxApi") { (hexPayload: String) throws -> String in
      clear_err()

      guard let resultPointer = call_tcx_api(hexPayload) else {
        throw TokenCoreBridgeError(message: Self.readLastError() ?? "Token Core returned no response.")
      }
      defer {
        free_const_string(resultPointer)
      }

      let result = String(cString: resultPointer)
      if let error = Self.readLastError() {
        throw TokenCoreBridgeError(message: error)
      }

      return result
    }
  }

  private static func readLastError() -> String? {
    guard let errorPointer = get_last_err_message() else {
      return nil
    }
    defer {
      free_const_string(errorPointer)
    }

    let message = String(cString: errorPointer)
    return message.isEmpty ? nil : message
  }

  private static func defaultFileDir() throws -> String {
    let documents = try FileManager.default.url(
      for: .documentDirectory,
      in: .userDomainMask,
      appropriateFor: nil,
      create: true
    )
    let tokenCoreDirectory = documents.appendingPathComponent("token-core", isDirectory: true)
    try FileManager.default.createDirectory(
      at: tokenCoreDirectory,
      withIntermediateDirectories: true
    )
    return tokenCoreDirectory.path
  }
}

private struct TokenCoreBridgeError: Error, LocalizedError, CustomStringConvertible {
  let message: String

  var errorDescription: String? {
    message
  }

  var description: String {
    message
  }
}
