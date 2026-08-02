import { Box, Stack, Text } from '@mantine/core'

/**
 * "Rendered simply" markdown for an agreement body — deliberately NO markdown dependency
 * (rich text is a recorded non-gap; the single-file demo budget guards new deps). Splits on blank
 * lines into blocks; a leading `#…` line renders as a bold heading, everything else as a paragraph with
 * whitespace preserved. The text is world CONTENT (like a note body), not UI copy, so it is not i18n'd.
 */
export function AgreementBody({ bodyMd }: { bodyMd: string }) {
    const blocks = bodyMd.split(/\n{2,}/).filter((block) => block.trim().length > 0)
    return (
        <Box
            data-testid="agreement-body"
            style={{ maxHeight: 320, overflowY: 'auto' }}
            p="sm"
            bd="1px solid var(--mantine-color-gray-3)"
        >
            <Stack gap="sm">
                {blocks.map((block, index) => {
                    const heading = /^#{1,6}\s+(.*)$/.exec(block.trim())
                    return heading ? (
                        <Text key={`${index}-h`} fw={700} size="md">
                            {heading[1]}
                        </Text>
                    ) : (
                        <Text key={`${index}-p`} size="sm" style={{ whiteSpace: 'pre-wrap' }}>
                            {block}
                        </Text>
                    )
                })}
            </Stack>
        </Box>
    )
}
