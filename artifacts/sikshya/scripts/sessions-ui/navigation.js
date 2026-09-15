import React from "react";

export function useFocusEffect(effect) {
  React.useEffect(effect, [effect]);
}
