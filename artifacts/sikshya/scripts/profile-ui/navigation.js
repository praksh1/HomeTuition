import { useEffect } from "react";
export function useFocusEffect(callback) { useEffect(callback, [callback]); }
