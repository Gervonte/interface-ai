import { Badge, Button, Container, Group, Paper, Stack, Text, TextInput, Title } from '@mantine/core';
import { useServiceHealth } from './useServiceHealth';

export function App() {
  const { status, retry } = useServiceHealth();
  return (
    <>
      <header>
        <Container size="md" py="md">
          <Group justify="space-between">
            <Text fw={750} className="brand">interface / member services</Text>
            <Badge color={status === 'connected' ? 'teal' : 'gray'} variant="light">
              {status === 'connected' ? 'API connected' : status === 'checking' ? 'Connecting' : 'API unavailable'}
            </Badge>
          </Group>
        </Container>
      </header>
      <main>
        <Container size="md" py={48}>
          <Stack gap="lg">
            <Badge variant="light" w="fit-content">Synthetic demonstration</Badge>
            <Title order={1}>Member services</Title>
            <Text c="dimmed" maw={620}>
              A staff workspace for finding members, viewing savings accounts, and reviewing contact details.
            </Text>
            <Paper withBorder p="xl" mt="md">
              <Stack>
                <Title order={2} size="h3">Find a member</Title>
                <TextInput
                  label="Member ID"
                  placeholder="For example, M1001"
                  disabled
                  description="Member search will be available when the demo workflow is connected."
                />
                <Button disabled w="fit-content">Search members</Button>
              </Stack>
            </Paper>
            <Text size="sm" c="dimmed">
              This workspace uses synthetic data. No member records are loaded yet.
            </Text>
            {status === 'unavailable' && (
              <Button variant="light" onClick={retry} w="fit-content">Retry connection</Button>
            )}
          </Stack>
        </Container>
      </main>
    </>
  );
}
