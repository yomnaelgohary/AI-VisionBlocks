import StageRunner from "../(shared)/StageRunner";

export default async function Module2StagePage({
  params,
}: {
  params: Promise<{ stage: string }>;
}) {
  const { stage } = await params;
  return <StageRunner stageId={stage} />;
}
