# AI chat card

Get a key from the [DeepSeek platform](https://platform.deepseek.com/). Save it and WiFi credentials to the board's NVS before deploying `app.js`. Create a **local, untracked** provisioning app with the following code, replace the placeholders locally, deploy it once, then deploy this example:

```js
lume.storage.kv.set('wifi_ssid', '<your WiFi SSID>');
lume.storage.kv.set('wifi_pass', '<your WiFi password>');
lume.ai.setKey('<your DeepSeek API key>');
```

Never commit the provisioning app or an API key. NVS stores these values as plaintext; anyone with physical flash access may extract them. The app cycles through three built-in questions because there is no keyboard widget yet. Responses are paged in 80-character slices to fit Lume's 256-byte text limit; non-ASCII text may reach that byte limit earlier. `chat()` blocks the JS engine for up to 30 seconds by default: the loading label may not paint and touch is unresponsive during the call. Real board networking and display behavior remain to be checked.
