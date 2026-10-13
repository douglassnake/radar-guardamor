# Publicação nas lojas — Radar Guarda-Mor

## Identidade
- App: Radar Guarda-Mor
- Bundle/package ID: `com.douglassnake.radarguardamor`
- Versão inicial: `1.0.0`
- Categoria: Tempo / Weather
- Política de privacidade: https://douglassnake.github.io/radar-guardamor/privacy.html
- Suporte: https://douglassnake.github.io/radar-guardamor/support.html

## Credenciais necessárias no GitHub Actions

### Google Play
- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`
- `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`

### Apple
- `APPLE_TEAM_ID`
- `APPLE_CERTIFICATE_P12_BASE64`
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_PROVISIONING_PROFILE_BASE64`
- `APP_STORE_CONNECT_KEY_ID`
- `APP_STORE_CONNECT_ISSUER_ID`
- `APP_STORE_CONNECT_API_KEY_BASE64`

Nunca coloque chaves privadas diretamente no repositório.

## Requisitos atuais
- Google Play: Android 16 / API 36 para novos apps e atualizações a partir de 31/08/2026.
- Apple: uploads para App Store Connect precisam ser construídos com Xcode 26+ / SDK iOS 26+ desde 28/04/2026.
