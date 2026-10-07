Pod::Spec.new do |s|
  s.name           = 'ActivityRecognition'
  s.version        = '1.0.0'
  s.summary        = 'Core Motion activity recognition per PARCHEGGIO'
  s.description    = 'Aggiornamenti e storico di CMMotionActivityManager esposti a JavaScript.'
  s.author         = 'PARCHEGGIO'
  s.homepage       = 'https://github.com/stefanodibella1-png/parcheggio'
  s.license        = { :type => 'UNLICENSED' }
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks     = 'CoreMotion'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
  s.source_files = "**/*.{h,m,mm,swift}"
end
