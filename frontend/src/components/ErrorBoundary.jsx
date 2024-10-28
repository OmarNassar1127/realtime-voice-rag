import React from 'react';
import { Box, Text, Button } from '@chakra-ui/react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Error caught by boundary:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <Box p={4} borderWidth="1px" borderRadius="lg" bg="red.50">
          <Text color="red.600" mb={4}>Something went wrong in this component.</Text>
          <Text color="red.400" fontSize="sm" mb={4}>{this.state.error?.message}</Text>
          <Button
            colorScheme="red"
            size="sm"
            onClick={() => {
              this.setState({ hasError: false, error: null });
              window.location.reload();
            }}
          >
            Try Again
          </Button>
        </Box>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
