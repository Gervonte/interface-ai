import { Badge, Button, Container, Group, Paper, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { useServiceHealth } from './useServiceHealth';

export function App() {
  const { status, retry } = useServiceHealth();
  return (
    <>
      <header>
        <Container size="md" py="md">
          <Group justify="space-between">
            <Text fw={750} className="brand">interface / automate</Text>
            <Badge color={status === 'connected' ? 'teal' : 'gray'} variant="light">
              {status === 'connected' ? 'API connected' : status === 'checking' ? 'Connecting' : 'API unavailable'}
            </Badge>
          </Group>
        </Container>
      </header>
      <main>
        <Container size="md" py={48}>
          <Stack gap="lg">
            <Title order={1}>Automation workspace</Title>
            <Text c="dimmed" maw={620}>
              Discover reusable workflows, inspect their results, and help when a run needs attention.
            </Text>
            <SimpleGrid cols={{ base: 1, sm: 2 }} mt="md">
              <Paper withBorder p="xl">
                <Stack gap="sm">
                  <Title order={2} size="h3">Balance lookup</Title>
                  <Text c="dimmed">Find a member's primary savings account and verify its current balance.</Text>
                  <Badge variant="light" w="fit-content">Planned</Badge>
                </Stack>
              </Paper>
              <Paper withBorder p="xl">
                <Stack gap="sm">
                  <Title order={2} size="h3">Contact update</Title>
                  <Text c="dimmed">Review a preferred-email change with an operator before saving.</Text>
                  <Badge variant="light" color="gray" w="fit-content">Follow-on</Badge>
                </Stack>
              </Paper>
            </SimpleGrid>
            <Paper withBorder p="xl">
              <Stack>
                <Title order={2} size="h3">Runs</Title>
                <Text c="dimmed">No runs yet. Run controls will be available when automation is connected.</Text>
                <Button disabled w="fit-content">Create run</Button>
              </Stack>
            </Paper>
            {status === 'unavailable' && (
              <Button variant="light" onClick={retry} w="fit-content">Retry connection</Button>
            )}
          </Stack>
        </Container>
      </main>
    </>
  );
}
