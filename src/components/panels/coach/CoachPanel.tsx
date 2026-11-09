import {
  Alert,
  Badge,
  Card,
  Divider,
  Group,
  Paper,
  ScrollArea,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconChess,
  IconHistory,
  IconInfoCircle,
  IconSparkles,
  IconTargetArrow,
} from "@tabler/icons-react";
import { useAtomValue } from "jotai";
import { useContext, useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { TreeStateContext } from "@/components/common/TreeStateContext";
import { activeTabAtom, engineMovesFamily, enginesAtom } from "@/state/atoms";
import { getVariationLine } from "@/utils/chess";
import { buildCoachReport, type CoachPoint } from "@/utils/coach";

function PointList({ points }: { points: CoachPoint[] }) {
  const { t } = useTranslation();
  return (
    <Stack gap={4}>
      {points.map((point, index) => (
        <Group key={`${point.key}-${index}`} align="flex-start" gap="xs" wrap="nowrap">
          <ThemeIcon size="xs" variant="transparent" color="blue" mt={3}>
            <IconChevronBullet />
          </ThemeIcon>
          <Text size="sm">{String(t(point.key as never, point.params as never))}</Text>
        </Group>
      ))}
    </Stack>
  );
}

function IconChevronBullet() {
  return <span style={{ fontSize: "0.75rem", lineHeight: 1 }}>•</span>;
}

function SectionCard({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <Card withBorder padding="sm">
      <Stack gap="xs">
        <Group gap="xs">
          <ThemeIcon size="sm" variant="light" color="blue">
            {icon}
          </ThemeIcon>
          <Title order={6}>{title}</Title>
        </Group>
        {children}
      </Stack>
    </Card>
  );
}

/**
 * A local, engine-grounded coaching view.
 *
 * It explains the engine's recommendation and the last move, lists tactical
 * alerts, and gives both sides a short plan. It deliberately does not call an
 * LLM: all claims come from the position and the already running engine.
 */
export default function CoachPanel() {
  const { t } = useTranslation();
  const store = useContext(TreeStateContext)!;
  const rootFen = useStore(store, (s) => s.root.fen);
  const currentNodeFen = useStore(store, (s) => s.currentNode().fen);
  const lastSan = useStore(store, (s) => s.currentNode().san);
  const moves = useStore(
    store,
    useShallow((s) => getVariationLine(s.root, s.position)),
  );
  const activeTab = useAtomValue(activeTabAtom);
  const engines = useAtomValue(enginesAtom) ?? [];
  const loadedEngines = engines.filter((engine) => engine.loaded);
  const engineId = loadedEngines[0]?.id ?? "none";
  const engineMoves = useAtomValue(engineMovesFamily({ engine: engineId, tab: activeTab ?? "" }));
  const bestMoves = engineMoves.get(`${rootFen}:${moves.join(",")}`);

  const report = useMemo(
    () => buildCoachReport(currentNodeFen, bestMoves, lastSan),
    [bestMoves, currentNodeFen, lastSan],
  );

  if (!report) {
    return (
      <Alert color="red" m="sm" icon={<IconInfoCircle size="1rem" />}>
        {t("Coach.InvalidPosition")}
      </Alert>
    );
  }

  const phaseKey =
    `Coach.Phase.${report.phase === "opening" ? "Opening" : report.phase === "endgame" ? "Endgame" : "Middlegame"}` as const;
  const advantageKey =
    `Coach.Advantage.${report.advantage === "white" ? "White" : report.advantage === "black" ? "Black" : "Equal"}` as const;

  return (
    <ScrollArea h="100%" offsetScrollbars type="auto">
      <Stack p="sm" gap="sm">
        <Paper withBorder p="sm">
          <Group gap="xs" align="center" wrap="nowrap">
            <ThemeIcon size="md" variant="light" color="blue">
              <IconSparkles size="1.1rem" />
            </ThemeIcon>
            <div style={{ minWidth: 0 }}>
              <Title order={5}>{t("Coach.Title")}</Title>
              <Text size="xs" c="dimmed">
                {t("Coach.Subtitle")}
              </Text>
            </div>
          </Group>
          <Group gap={4} mt="xs">
            <Badge variant="light">{t(phaseKey)}</Badge>
            <Badge variant="outline">{t(advantageKey)}</Badge>
          </Group>
          <Divider my="sm" />
          <Group gap="xs">
            <Badge size="lg" variant="filled">
              {report.scoreText}
            </Badge>
            <Text size="xs" c="dimmed">
              {t("Coach.ScoreSide", {
                side: report.turn === "white" ? t("Coach.Turn.White") : t("Coach.Turn.Black"),
              })}
            </Text>
          </Group>
        </Paper>

        {loadedEngines.length > 0 && !bestMoves?.length && (
          <Alert color="blue" icon={<IconInfoCircle size="1rem" />}>
            {t("Coach.WaitingForEngine")}
          </Alert>
        )}

        {report.best && (
          <SectionCard
            icon={<IconTargetArrow size="1rem" />}
            title={t("Coach.EngineRecommendation")}
          >
            <Group gap="xs">
              <Badge size="lg" color="blue" tt="none" ff="monospace">
                {report.best.san}
              </Badge>
              <Text size="xs" c="dimmed">
                {t("Coach.EngineGrounded")}
              </Text>
            </Group>
            <PointList points={report.best.points} />
          </SectionCard>
        )}

        {report.last && (
          <SectionCard icon={<IconHistory size="1rem" />} title={t("Coach.LastMove")}>
            <Badge size="lg" variant="outline" tt="none" ff="monospace">
              {report.last.san}
            </Badge>
            <PointList points={report.last.points} />
          </SectionCard>
        )}

        <SectionCard icon={<IconAlertTriangle size="1rem" />} title={t("Coach.TacticalAlerts")}>
          <PointList points={report.tactics} />
        </SectionCard>

        <SectionCard icon={<IconChess size="1rem" />} title={t("Coach.Plans")}>
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
            <Stack gap={4}>
              <Text size="xs" fw={700} c="dimmed">
                {t("Coach.Plans.White")}
              </Text>
              <PointList points={report.whitePlan} />
            </Stack>
            <Stack gap={4}>
              <Text size="xs" fw={700} c="dimmed">
                {t("Coach.Plans.Black")}
              </Text>
              <PointList points={report.blackPlan} />
            </Stack>
          </SimpleGrid>
        </SectionCard>

        {loadedEngines.length === 0 && (
          <Alert color="blue" icon={<IconInfoCircle size="1rem" />}>
            {t("Coach.NoEngine")}
          </Alert>
        )}
        <Text size="xs" c="dimmed">
          {t("Coach.Disclaimer")}
        </Text>
      </Stack>
    </ScrollArea>
  );
}
