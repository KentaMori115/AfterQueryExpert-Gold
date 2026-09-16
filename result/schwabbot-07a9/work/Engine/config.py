# Harbor / local replay: leave SBOT_OFFLINE unset or 1. Set 0 only for live Schwab.
# Develoepr Port Information
CLIENT_ID = "LfVXuyTA2V6crYAL6oGonr8UbRXvKH36"
CLIENT_SECRET = "QjokzlGRi6PPXVfo"
#REDIRECT_URI = "https://127.0.0.1:8013"
REDIRECT_URI = "https://dd.blueoceantrading.org/schwab_callback"

#Environment Information
SCHWAB_BASE_URL = "https://api.schwabapi.com/v1"
SCHWAB_MARKET_URL = "https://api.schwabapi.com/marketdata/v1"
SCHWAB_TRADER_URL = "https://api.schwabapi.com/trader/v1"

SERVER_ENDPOINT = "http://127.0.0.1:8013"
WS_ENDPOINT = "ws://127.0.0.1:8013"
#WS_ENDPOINT = "wss://test.blueoceantrading.org"


#define endpoint
AUTH_ENDPOINT = f'{SCHWAB_BASE_URL}/oauth/authorize'
TOKEN_ENDPOINT = f'{SCHWAB_BASE_URL}/oauth/token'

#define constant
ACC_TOKEN_EXPIRE_SEC = 600
REF_TOKEN_EXPIRE_DAY = 6




#bot1 setting
BOT1_TOKEN_PATH = 'bot1_schwab_token.json'
BOT1_USER_INFO_PATH = 'bot1_user_settings.json'
BOT1_ADMIN_INFO_PATH = 'bot1_admin_settings.json'
BOT1_TIME_ZONE = "US/Eastern"
BOT1_RUN_HOUR = 12
BOT1_RUN_MIN = 53
BOT1_PRE_TRADING_MIN = 1
BOT1_CHECK_MIN = 10


#bot2 setting
BOT2_TOKEN_PATH = 'bot2_schwab_token.json'
BOT2_USER_INFO_PATH = 'bot2_user_settings.json'
BOT2_ADMIN_INFO_PATH = 'bot2_admin_settings.json'
BOT2_TIME_ZONE = "US/Eastern"
BOT2_RUN_HOUR = 12
BOT2_RUN_MIN = 53
BOT2_PRE_TRADING_MIN = 1
BOT2_CHECK_MIN = 10

#bot1 order working ladder
#The bot opens at the package midpoint and then replaces the order a few
#times before it gives up and pays the market. BOT1_LADDER_STEPS counts the
#opening quote as well as the replacements, so 4 means one opening order plus
#three replacements, which is the cadence the old fixed repeat count ran on.
#An operator can override it per run from the admin settings file; anything
#outside 1..BOT1_LADDER_MAX_STEPS is pulled back into range.
BOT1_LADDER_STEPS = 4
BOT1_LADDER_MAX_STEPS = 8
