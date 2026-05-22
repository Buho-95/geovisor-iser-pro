const path = require('path');
const fs = require('fs');

const adminPath = 'c:\\Users\\USUARIO\\Documents\\Trabajos Varios PC Master\\pagina wb geovisor ISER Pamplona\\Clon_Repositorio\\geovisor-iser-pro\\functions\\node_modules\\firebase-admin';
const admin = require(adminPath);

const PROJECT_ID = 'geovisor-iser';
const BUCKET_NAME = `${PROJECT_ID}.firebasestorage.app`;

async function main() {
  const home = process.env.USERPROFILE || process.env.HOME || '';
  const configPath = path.join(home, '.config', 'configstore', 'firebase-tools.json');
  if (!fs.existsSync(configPath)) {
    console.error('No configstore found at: ' + configPath);
    process.exit(1);
  }
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const refreshToken = config.tokens && config.tokens.refresh_token;
  if (!refreshToken) {
    console.error('No refresh token found in configstore');
    process.exit(1);
  }

  const FIREBASE_CLI_CLIENT_ID = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
  const FIREBASE_CLI_CLIENT_SECRET = 'j9iVZfS8kkCEFUPaAeJV0sAi';

  const adc = {
    client_id: FIREBASE_CLI_CLIENT_ID,
    client_secret: FIREBASE_CLI_CLIENT_SECRET,
    refresh_token: refreshToken,
    type: 'authorized_user'
  };

  const tempAdcPath = path.join(__dirname, 'temp-adc.json');
  fs.writeFileSync(tempAdcPath, JSON.stringify(adc, null, 2));

  process.env.GOOGLE_APPLICATION_CREDENTIALS = tempAdcPath;

  try {
    admin.initializeApp({ projectId: PROJECT_ID, storageBucket: BUCKET_NAME });
    const bucket = admin.storage().bucket();

    console.log('Listing files under sedes/pamplona/ that are NOT .keep...');
    const [files] = await bucket.getFiles({ prefix: 'sedes/pamplona/', autoPaginate: true });
    const realFiles = files.filter(f => !f.name.endsWith('.keep'));
    console.log(`Found ${realFiles.length} real files under sedes/pamplona/:`);
    realFiles.slice(0, 20).forEach(f => {
      console.log(`  - ${f.name} (size: ${f.metadata.size})`);
    });

  } catch (error) {
    console.error('Execution failed:', error);
  } finally {
    if (fs.existsSync(tempAdcPath)) {
      fs.unlinkSync(tempAdcPath);
    }
  }
}

main().catch(console.error);
