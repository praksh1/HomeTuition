import type { ComponentProps } from "react";
import type SmartBoardWeb from "./SmartBoard.web";

// The native app hosts /board in a WebView. Its own route displays the fallback in board.tsx;
// importing the web editor at runtime here would pull Node-only Excalidraw dependencies into
// the Android/iOS bundle even though that branch is never rendered.
export default function BoardRouteEditor(_props: ComponentProps<typeof SmartBoardWeb>) {
  return null;
}
