import type { PlasmoCSConfig } from "plasmo"

import "../contents/chatgpt"

export const config: PlasmoCSConfig = {
  matches: ["https://chat.openai.com/*", "https://chatgpt.com/*"]
}
