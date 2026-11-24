import { createRoot } from 'react-dom/client';
import { CssBaseline, ThemeProvider, createTheme } from '@mui/material';
import bank from './bank-config';
import App from './App';

document.title = `${bank.name} | Digital banking`;
document.documentElement.dataset.bank = bank.theme;

const theme = createTheme({
  palette: {
    primary: { main: bank.color },
    background: { default: '#eef3f1' },
  },
  shape: { borderRadius: 12 },
  typography: {
    fontFamily: '"Outfit", system-ui, sans-serif',
    button: { textTransform: 'none', fontWeight: 700 },
  },
  components: { MuiButton: { defaultProps: { disableElevation: true } } },
});

createRoot(document.getElementById('root')).render(
  <ThemeProvider theme={theme}>
    <CssBaseline />
    <App />
  </ThemeProvider>,
);
