import StageRunner from "../(shared)/StageRunner";

export default function Module4StagePage({ params }: { params: { stage: string } }) {
  return <StageRunner stageId={params.stage} />;
}
