import StageRunner from "../(shared)/StageRunner";

export default function Module2StagePage({ params }: { params: { stage: string } }) {
  return <StageRunner stageId={params.stage} />;
}
