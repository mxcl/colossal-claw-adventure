import "./index.css";
import { Composition } from "remotion";
import { ColossalClawPromo } from "./Composition";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="ColossalClawPromo"
        component={ColossalClawPromo}
        durationInFrames={910}
        fps={30}
        width={1920}
        height={1080}
      />
    </>
  );
};
