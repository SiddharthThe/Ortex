This is a [Plasmo extension](https://docs.plasmo.com/) project bootstrapped with [`plasmo init`](https://www.npmjs.com/package/plasmo).

## Getting Started

First, run the development server:

```bash
pnpm dev
# or
npm run dev
```

Open your browser and load the appropriate development build. For example, if you are developing for the chrome browser, using manifest v3, use: `build/chrome-mv3-dev`.

You can start editing the popup by modifying `popup.tsx`. It should auto-update as you make changes. To add an options page, simply add a `options.tsx` file to the root of the project, with a react component default exported. Likewise to add a content page, add a `content.ts` file to the root of the project, importing some module and do some logic, then reload the extension on your browser.

For further guidance, [visit our Documentation](https://docs.plasmo.com/)

## Making production build

Run the following:

```bash
pnpm build
# or
npm run build
```

This should create a production bundle for your extension, ready to be zipped and published to the stores.

## Ortex ChatGPT flow

The current milestone supports ChatGPT tabs only:

1. Open a rendered ChatGPT conversation and open the Ortex popup.
2. Select **Extract**, review the detected messages, and choose **Save**.
3. Use the **Saved** tab to select a stored conversation.
4. Open another ChatGPT tab, select it as the destination, and choose **Transfer Context**.
5. Review the inserted draft in ChatGPT. Ortex never submits it automatically.

Conversations are stored locally in IndexedDB. The extension does not send conversation
content to a remote service.

To load a production build in Chrome:

1. Run `npm run build`.
2. Open `chrome://extensions`, enable **Developer mode**, and choose **Load unpacked**.
3. Select `build/chrome-mv3-prod`.
4. Reload ChatGPT tabs after installing or rebuilding so the content script is injected.

The generated manifest limits content-script injection and host permissions to
`chat.openai.com` and `chatgpt.com`.

## Submit to the webstores

The easiest way to deploy your Plasmo extension is to use the built-in [bpp](https://bpp.browser.market) GitHub action. Prior to using this action however, make sure to build your extension and upload the first version to the store to establish the basic credentials. Then, simply follow [this setup instruction](https://docs.plasmo.com/framework/workflows/submit) and you should be on your way for automated submission!
