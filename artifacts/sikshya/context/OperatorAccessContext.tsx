import { createContext, useContext } from "react";

/** Navigation must mount before redirects, but private screens must wait for /operator/me. */
export const OperatorAccessContext = createContext(false);
export function useOperatorAccess(): boolean {
  return useContext(OperatorAccessContext);
}
