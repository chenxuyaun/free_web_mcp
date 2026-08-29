/** Base path for sub-path deployment behind the yuncai.site nginx proxy.
 *  Keep in sync with basePath in next.config.mjs — client-side fetches are
 *  not rewritten by Next, so they must prefix their URLs with this. */
export const BASE_PATH = "/webmcp";
