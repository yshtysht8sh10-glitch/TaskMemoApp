import Constants from 'expo-constants';
import { buildInfoFromExpoConfig } from './buildInfoValue';

export { buildInfoFromExpoConfig, compactBuildLabel } from './buildInfoValue';

export function currentBuildInfo() {
  return buildInfoFromExpoConfig(Constants.expoConfig);
}
