/**
 * Feature Flags — opções de comportamento do Porto live.
 *
 * Para ativar/desativar uma funcionalidade basta alterar o valor para
 * true ou false. Não são necessárias mais alterações no código.
 *
 * REALTIME_BUSES_ENABLED
 *   true  — comportamento normal: autocarros aparecem no mapa e são
 *           associados às chegadas em tempo real nas paragens.
 *   false — autocarros ocultados em ambas as páginas e é mostrado um
 *           banner de aviso a informar que o serviço está indisponível.
 *           Útil quando a API de localização em tempo real está a devolver
 *           dados desatualizados ou incorretos.
 */
export const REALTIME_BUSES_ENABLED = true;
