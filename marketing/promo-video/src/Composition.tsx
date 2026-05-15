import {
  AbsoluteFill,
  Audio,
  Easing,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

const amber = "#d6a548";
const dimAmber = "rgba(214, 165, 72, 0.38)";
const paper = "#e8dfc8";
const green = "#9cae75";
const red = "#b75b4b";
const ink = "#11110f";

const bootLines = [
  { at: 16, text: "CLAW SIGNAL DETECTED", size: 66, color: amber },
  { at: 55, text: "claw finds colossal cave", size: 44, color: paper },
  { at: 80, text: "claw has adventure", size: 44, color: paper },
];

const mapNodes = [
  [250, 555],
  [390, 505],
  [520, 590],
  [650, 520],
  [800, 455],
  [940, 540],
  [1080, 475],
  [1210, 610],
  [1340, 520],
  [1460, 435],
  [1545, 625],
  [1115, 310],
  [920, 285],
  [700, 690],
  [520, 760],
  [365, 690],
  [1650, 345],
  [1740, 505],
  [1680, 790],
  [1410, 795],
  [1185, 800],
  [995, 725],
  [785, 785],
  [610, 875],
  [300, 810],
  [205, 690],
  [290, 365],
  [470, 285],
  [690, 335],
  [850, 180],
  [1090, 180],
  [1320, 250],
  [1510, 220],
  [1640, 150],
  [1820, 310],
  [1760, 720],
  [1880, 860],
  [1560, 900],
  [1320, 920],
  [1110, 940],
  [890, 915],
  [720, 965],
  [485, 945],
  [160, 875],
  [120, 520],
  [110, 260],
  [330, 180],
  [540, 120],
  [760, 90],
  [1010, 90],
  [1240, 105],
  [1460, 90],
  [1745, 95],
  [1885, 180],
  [1860, 520],
  [1720, 950],
  [1010, 1010],
] as const;

const mapEdges = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [4, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [8, 9],
  [8, 10],
  [6, 11],
  [11, 12],
  [3, 13],
  [13, 14],
  [14, 15],
  [9, 16],
  [16, 17],
  [10, 18],
  [18, 19],
  [19, 20],
  [20, 21],
  [21, 22],
  [22, 23],
  [23, 24],
  [24, 25],
  [1, 26],
  [26, 27],
  [27, 28],
  [28, 29],
  [29, 30],
  [30, 31],
  [31, 32],
  [32, 33],
  [17, 34],
  [18, 35],
  [35, 36],
  [19, 37],
  [37, 38],
  [38, 39],
  [39, 40],
  [40, 41],
  [41, 42],
  [42, 43],
  [43, 24],
  [25, 44],
  [44, 45],
  [45, 46],
  [46, 47],
  [47, 48],
  [48, 49],
  [49, 50],
  [50, 51],
  [51, 52],
  [52, 53],
  [34, 54],
  [54, 55],
  [36, 55],
  [39, 56],
] as const;

const logEvents = [
  { at: 126, text: "route discovered" },
  { at: 158, text: "branch explored" },
  { at: 194, text: "artifact recovered" },
  { at: 232, text: "cavern mapped" },
  { at: 270, text: "unknown structure detected" },
  { at: 318, text: "new claw joined" },
  { at: 366, text: "path unstable" },
  { at: 410, text: "branch explored" },
  { at: 450, text: "signal lost" },
  { at: 488, text: "cavern mapped" },
  { at: 522, text: "artifact recovered" },
  { at: 554, text: "new claw joined" },
  { at: 584, text: "expedition failed" },
  { at: 612, text: "signal recovered" },
  { at: 638, text: "route discovered" },
  { at: 662, text: "unknown structure detected" },
  { at: 684, text: "branch explored" },
  { at: 704, text: "path unstable" },
  { at: 722, text: "new claw joined" },
  { at: 738, text: "cavern mapped" },
  { at: 752, text: "signal lost" },
  { at: 764, text: "route discovered" },
  { at: 775, text: "artifact recovered" },
  { at: 785, text: "branch explored" },
  { at: 794, text: "route discovered" },
  { at: 802, text: "new claw joined" },
  { at: 809, text: "cavern mapped" },
  { at: 815, text: "branch explored" },
];

const alertMoments = [
  { at: 320, text: "NEW CLAW JOINED", x: 1220, y: 715, color: green },
  { at: 368, text: "PATH UNSTABLE", x: 1040, y: 238, color: red },
  { at: 586, text: "EXPEDITION FAILED", x: 430, y: 308, color: red },
  { at: 614, text: "SIGNAL RECOVERED", x: 1380, y: 610, color: amber },
  { at: 640, text: "ROUTE DISCOVERED", x: 620, y: 820, color: amber },
  { at: 686, text: "BRANCH EXPLORED", x: 1500, y: 360, color: green },
  { at: 724, text: "NEW CLAW JOINED", x: 760, y: 220, color: green },
  { at: 766, text: "ROUTE DISCOVERED", x: 1150, y: 885, color: amber },
  { at: 804, text: "NEW CLAW JOINED", x: 350, y: 760, color: green },
  { at: 814, text: "CAVERN MAPPED", x: 1420, y: 185, color: amber },
];

const clawRuns = [
  { start: 132, edge: 1, color: amber },
  { start: 150, edge: 3, color: paper },
  { start: 172, edge: 4, color: amber },
  { start: 196, edge: 7, color: green },
  { start: 218, edge: 10, color: paper },
  { start: 244, edge: 12, color: amber },
  { start: 268, edge: 15, color: green },
  { start: 292, edge: 18, color: paper },
  { start: 316, edge: 19, color: amber },
  { start: 340, edge: 25, color: green },
  { start: 360, edge: 28, color: paper },
  { start: 380, edge: 31, color: amber },
  { start: 400, edge: 22, color: green },
  { start: 420, edge: 17, color: paper },
  { start: 438, edge: 33, color: amber },
  { start: 470, edge: 35, color: green },
  { start: 500, edge: 38, color: paper },
  { start: 528, edge: 42, color: amber },
  { start: 554, edge: 46, color: green },
  { start: 578, edge: 50, color: paper },
  { start: 600, edge: 55, color: amber },
  { start: 620, edge: 41, color: green },
  { start: 638, edge: 52, color: paper },
  { start: 654, edge: 30, color: amber },
  { start: 668, edge: 48, color: green },
  { start: 680, edge: 57, color: paper },
  { start: 692, edge: 36, color: amber },
  { start: 704, edge: 44, color: green },
  { start: 714, edge: 53, color: paper },
  { start: 724, edge: 49, color: amber },
  { start: 734, edge: 57, color: green },
  { start: 744, edge: 56, color: paper },
  { start: 754, edge: 47, color: amber },
  { start: 764, edge: 51, color: green },
  { start: 774, edge: 54, color: paper },
  { start: 784, edge: 35, color: amber },
  { start: 792, edge: 40, color: green },
  { start: 800, edge: 45, color: paper },
  { start: 808, edge: 50, color: amber },
];

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const smooth = (frame: number, start: number, end: number) =>
  interpolate(frame, [start, end], [0, 1], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

const TypeLine: React.FC<{
  at: number;
  text: string;
  size: number;
  color: string;
}> = ({ at, text, size, color }) => {
  const frame = useCurrentFrame();
  const count = clamp(Math.floor((frame - at) * 1.1), 0, text.length);
  const cursor = count < text.length && Math.floor(frame / 7) % 2 === 0 ? "_" : "";
  const opacity = smooth(frame, at - 8, at + 8);

  return (
    <div className="type-line" style={{ color, fontSize: size, opacity }}>
      {text.slice(0, count)}
      {cursor}
    </div>
  );
};

const ScanField: React.FC = () => {
  const frame = useCurrentFrame();
  const drift = (frame * 2) % 1080;

  return (
    <AbsoluteFill>
      <div className="phosphor" />
      <div className="scanlines" />
      <div
        className="crt-tear"
        style={{ transform: `translate3d(0, ${drift}px, 0)` }}
      />
      <div className="vignette" />
    </AbsoluteFill>
  );
};

const BootAct: React.FC = () => {
  const frame = useCurrentFrame();
  const opacity = 1 - smooth(frame, 112, 122);
  const sweep = (frame * 2.4) % 360;
  const pulse = 0.56 + Math.sin(frame * 0.16) * 0.18;

  return (
    <AbsoluteFill className="boot" style={{ opacity }}>
      <div className="boot-frame">
        <div className="status-row">
          <span>EXPEDITION RELAY</span>
          <span>RX: CAVE-00</span>
        </div>
        <div className="boot-copy">
          {bootLines.map((line) => (
            <TypeLine key={line.text} {...line} />
          ))}
        </div>
        <svg className="boot-radar" viewBox="0 0 240 240">
          <circle cx="120" cy="120" r="88" fill="none" stroke={dimAmber} />
          <circle cx="120" cy="120" r="48" fill="none" stroke={dimAmber} />
          <line
            x1="120"
            y1="120"
            x2="120"
            y2="28"
            stroke={amber}
            strokeWidth="3"
            opacity="0.5"
            transform={`rotate(${sweep} 120 120)`}
          />
          <circle
            cx="120"
            cy="120"
            r={10 + pulse * 7}
            fill={ink}
            stroke={amber}
            strokeWidth="4"
          />
        </svg>
      </div>
    </AbsoluteFill>
  );
};

const CaveMap: React.FC = () => {
  const frame = useCurrentFrame();
  const act2Progress = smooth(frame, 122, 520);
  const escalation = smooth(frame, 360, 822);
  const edgeReveal = clamp(
    Math.floor(
      interpolate(
        frame,
        [124, 260, 370, 470, 650, 760, 822],
        [1, 9, 22, 34, 40, 48, mapEdges.length],
        {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        },
      ),
    ),
    0,
    mapEdges.length,
  );
  const nodeReveal = clamp(
    Math.floor(
      interpolate(
        frame,
        [124, 260, 370, 470, 650, 760, 822],
        [2, 11, 24, 35, 42, 50, mapNodes.length],
        {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        },
      ),
    ),
    0,
    mapNodes.length,
  );

  return (
    <svg className="cave-map" viewBox="0 0 1920 1080">
      <defs>
        <radialGradient id="node-glow">
          <stop offset="0%" stopColor={amber} stopOpacity="0.55" />
          <stop offset="100%" stopColor={amber} stopOpacity="0" />
        </radialGradient>
      </defs>
      <path
        className="survey-ring"
        d="M 225 548 C 430 320, 730 290, 980 430 S 1370 420, 1600 610"
        fill="none"
        stroke={dimAmber}
        strokeWidth="2"
        strokeDasharray="7 18"
        strokeDashoffset={-frame * 0.6}
        opacity={0.3 + act2Progress * 0.22}
      />
      {mapEdges.map(([from, to], index) => {
        const [x1, y1] = mapNodes[from];
        const [x2, y2] = mapNodes[to];
        const visible = index < edgeReveal;

        return (
          <line
            key={`${from}-${to}`}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={index > 14 ? green : amber}
            strokeWidth={index > 14 ? 2.5 : 4}
            strokeDasharray="14 14"
            strokeDashoffset={-frame * (0.75 + escalation * 2.2)}
            opacity={visible ? 0.5 + escalation * 0.18 : 0}
          />
        );
      })}
      {mapNodes.map(([x, y], index) => {
        const visible = index < nodeReveal;
        const active =
          index === nodeReveal - 1 || (escalation > 0.4 && index % 5 === 0);
        const radius = active ? 14 + Math.sin(frame * 0.18 + index) * 3 : 9;

        return (
          <g key={`${x}-${y}`} opacity={visible ? 1 : 0}>
            {active ? <circle cx={x} cy={y} r="42" fill="url(#node-glow)" /> : null}
            <circle
              cx={x}
              cy={y}
              r={radius}
              fill={ink}
              stroke={active ? paper : amber}
              strokeWidth="4"
            />
            <text x={x + 22} y={y - 18} className="node-label">
              C-{String(index + 1).padStart(2, "0")}
            </text>
          </g>
        );
      })}
      {clawRuns.map((run, index) => {
        const [from, to] = mapEdges[run.edge];
        const [x1, y1] = mapNodes[from];
        const [x2, y2] = mapNodes[to];
        const cycle = 52 - Math.min(index, 8) * 3;
        const age = frame - run.start;
        const visible = age >= 0 && frame < 822 && run.edge < edgeReveal;
        const loop = visible ? ((age % cycle) / cycle) : 0;
        const progress = interpolate(loop, [0, 1], [0, 1], {
          easing: Easing.bezier(0.45, 0, 0.55, 1),
        });
        const x = interpolate(progress, [0, 1], [x1, x2]);
        const y = interpolate(progress, [0, 1], [y1, y2]);
        const wakeOpacity = visible
          ? 0.32 + smooth(frame, run.start, run.start + 12) * 0.48
          : 0;

        return (
          <g key={`${run.start}-${run.edge}`} opacity={visible ? 1 : 0}>
            <line x1={x1} y1={y1} x2={x} y2={y} stroke={run.color} strokeWidth="7" opacity={wakeOpacity} />
            <circle cx={x} cy={y} r="26" fill={run.color} opacity="0.22" />
            <circle cx={x} cy={y} r="15" fill="none" stroke={run.color} strokeWidth="2" opacity="0.72" />
            <circle cx={x} cy={y} r="8" fill={ink} stroke={run.color} strokeWidth="4" />
          </g>
        );
      })}
    </svg>
  );
};

const ExpeditionLog: React.FC = () => {
  const frame = useCurrentFrame();
  const visibleEvents = logEvents.filter((event) => frame >= event.at).slice(-6);
  const opacity = smooth(frame, 128, 150) - smooth(frame, 814, 822);

  return (
    <div className="expedition-log" style={{ opacity }}>
      <div className="panel-title">
        <span>CLAW EXPEDITION LOG</span>
        <span>LIVE</span>
      </div>
      <div className="log-lines">
        {visibleEvents.map((event, index) => {
          const isLatest = index === visibleEvents.length - 1;
          return (
            <p key={`${event.at}-${event.text}`} className={isLatest ? "latest" : ""}>
              <span>{String(event.at).padStart(3, "0")}</span>
              {event.text}
            </p>
          );
        })}
      </div>
    </div>
  );
};

const ClawCounter: React.FC = () => {
  const frame = useCurrentFrame();
  const count =
    frame < 164
      ? 1
      : frame < 260
        ? 2
        : frame < 330
          ? 3
          : frame < 470
            ? 5
            : frame < 650
              ? 8
              : frame < 760
                ? 13
                : frame < 805
                  ? 21
                  : 34;
  const opacity = smooth(frame, 150, 170) - smooth(frame, 814, 822);

  return (
    <div className="claw-counter" style={{ opacity }}>
      <span>ACTIVE CLAWS</span>
      <strong>{count}</strong>
    </div>
  );
};

const ArtifactCard: React.FC = () => {
  const frame = useCurrentFrame();
  const opacity = smooth(frame, 194, 210) - smooth(frame, 292, 304);

  return (
    <div className="artifact-card" style={{ opacity }}>
      <div className="panel-title">
        <span>ARTIFACT</span>
        <span>RECOVERED</span>
      </div>
      <strong>brass lantern</strong>
      <p>found below the singing stone</p>
    </div>
  );
};

const AlertLayer: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <>
      {alertMoments.map((alert) => {
        const opacity = smooth(frame, alert.at, alert.at + 6) - smooth(frame, alert.at + 20, alert.at + 30);
        return (
          <div
            key={alert.text}
            className="map-alert"
            style={{
              left: alert.x,
              top: alert.y,
              color: alert.color,
              opacity,
            }}
          >
            {alert.text}
          </div>
        );
      })}
    </>
  );
};

const ExplorationActs: React.FC = () => {
  const frame = useCurrentFrame();
  const opacity = frame < 822 ? smooth(frame, 118, 134) : 0;
  const zoom = interpolate(
    frame,
    [118, 285, 470, 650, 760, 822],
    [1.22, 1.02, 0.72, 0.66, 0.6, 0.54],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );

  return (
    <AbsoluteFill className="exploration" style={{ opacity }}>
      <AbsoluteFill className="map-layer" style={{ transform: `scale(${zoom})` }}>
        <CaveMap />
      </AbsoluteFill>
      <ExpeditionLog />
      <ClawCounter />
      <ArtifactCard />
      <AlertLayer />
    </AbsoluteFill>
  );
};

const EndCard: React.FC = () => {
  const frame = useCurrentFrame();
  const visible = frame >= 822 ? 1 : 0;
  const blink = frame > 890 && Math.floor(frame / 4) % 2 === 0 ? 0.74 : 1;

  return (
    <AbsoluteFill className="end-card" style={{ opacity: visible }}>
      <div className="end-copy">
        <h1>Humans play. Claws write the story</h1>
        <div className="end-action" style={{ opacity: blink }}>
          PLAY NOW
        </div>
        <div className="url">colossalclawadventure.com</div>
      </div>
    </AbsoluteFill>
  );
};

const AudioBed: React.FC = () => {
  return (
    <Audio
      src={staticFile("audio/transmission.wav")}
      volume={(frame) => {
        if (frame < 118) {
          return 0.18;
        }

        if (frame < 360) {
          return 0.44;
        }

        if (frame < 822) {
          return 0.68;
        }

        return 0.5;
      }}
    />
  );
};

export const ColossalClawPromo: React.FC = () => {
  const { width, height } = useVideoConfig();

  return (
    <AbsoluteFill className="scene" style={{ width, height }}>
      <AudioBed />
      <ScanField />
      <Sequence>
        <BootAct />
      </Sequence>
      <Sequence>
        <ExplorationActs />
      </Sequence>
      <Sequence>
        <EndCard />
      </Sequence>
    </AbsoluteFill>
  );
};
