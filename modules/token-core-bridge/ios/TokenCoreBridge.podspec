Pod::Spec.new do |s|
  s.name           = 'TokenCoreBridge'
  s.version        = '1.0.0'
  s.summary        = 'Expo bridge for Token Core'
  s.description    = 'Exposes Token Core X call_tcx_api to the Expo wallet runtime.'
  s.author         = ''
  s.homepage       = 'https://github.com/consenlabs/token-core-monorepo'
  s.platforms      = {
    :ios => '15.1',
    :tvos => '15.1'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.vendored_frameworks = 'Vendor/TokenCoreX.framework'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "TokenCoreBridgeModule.swift", "include/**/*.{h}"
  s.public_header_files = "include/**/*.h"
end
