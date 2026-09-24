import Foundation
import Security

enum Command: String {
    case set
    case get
    case delete
}

func fail(_ message: String, code: Int32 = 1) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(code)
}

guard CommandLine.arguments.count == 4,
      let command = Command(rawValue: CommandLine.arguments[1]) else {
    fail("Usage: keychain-helper <set|get|delete> <service> <account>")
}

let service = CommandLine.arguments[2]
let account = CommandLine.arguments[3]
let baseQuery: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: service,
    kSecAttrAccount as String: account,
]

switch command {
case .set:
    let secret = FileHandle.standardInput.readDataToEndOfFile()
    guard !secret.isEmpty else { fail("Secret input is empty") }
    SecItemDelete(baseQuery as CFDictionary)
    var attributes = baseQuery
    attributes[kSecValueData as String] = secret
    let status = SecItemAdd(attributes as CFDictionary, nil)
    guard status == errSecSuccess else {
        fail("Keychain set failed: \(status)")
    }

case .get:
    var query = baseQuery
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecItemNotFound { exit(44) }
    guard status == errSecSuccess, let data = result as? Data else {
        fail("Keychain get failed: \(status)")
    }
    FileHandle.standardOutput.write(data)

case .delete:
    let status = SecItemDelete(baseQuery as CFDictionary)
    if status == errSecItemNotFound { exit(44) }
    guard status == errSecSuccess else {
        fail("Keychain delete failed: \(status)")
    }
}
