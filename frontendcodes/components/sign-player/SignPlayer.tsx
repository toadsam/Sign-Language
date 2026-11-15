import EmbeddedViewer from './EmbeddedViewer';
import type { MotionResponse } from './motion';
export type SignPlayerProps = { motion: MotionResponse };
export default function SignPlayer({motion}: SignPlayerProps) {
  return <EmbeddedViewer route="sign-player" motion={motion}/>;
}
