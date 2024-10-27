import React from 'react';
import { Box, Text, VStack, Heading } from '@chakra-ui/react';

const Citations = ({ citations }) => {
  if (!citations || citations.length === 0) return null;

  return (
    <Box mt={4} p={4} borderWidth="1px" borderRadius="lg">
      <Heading size="sm" mb={2}>Sources Used</Heading>
      <VStack align="stretch" spacing={2}>
        {citations.map((citation, index) => (
          <Box key={index} p={2} bg="gray.50" borderRadius="md">
            <Text fontSize="sm">{citation.text}</Text>
            <Text fontSize="xs" color="gray.600">
              Source: {citation.source}
              {citation.score && ` (Relevance: ${Math.round(citation.score * 100)}%)`}
            </Text>
          </Box>
        ))}
      </VStack>
    </Box>
  );
};

export default Citations;
