import EmbeddedViewer from './EmbeddedViewer';
export type ComparisonPlayerProps = { mode?: 'four' | 'reconstruction' };
export default function ComparisonPlayer({mode='four'}: ComparisonPlayerProps) {
  return <EmbeddedViewer route={mode==='reconstruction'?'sign-reconstruct':'sign-compare'}/>;
}
