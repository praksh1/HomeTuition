import React from "react";

// The test drives the real tab component, but never opens another app route.
export function Link({ children }) { return React.cloneElement(children); }
