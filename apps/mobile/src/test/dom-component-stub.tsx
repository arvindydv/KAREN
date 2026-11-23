/**
 * Jest stand-in for Expo DOM components (`*.dom.tsx`): they render inside a native WebView,
 * which the Jest native environment does not have. Decorative DOM components render nothing.
 */
export default function DomComponentStub() {
  return null;
}
