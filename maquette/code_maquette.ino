#include <PZEM004T.h>
#include <WiFi.h>
#include <PubSubClient.h>

PZEM004T pzem(&Serial2);
IPAddress ip(192, 168, 1, 1);

const char* ssid        = "";
const char* password    = "";
const char* mqtt_server = "";

WiFiClient   espClient;
PubSubClient client(espClient);

void setup() {
  Serial.begin(115200);
  Serial2.begin(9600, SERIAL_8N1, 16, 17);
  delay(2000);
  
  Serial.println("Demarrage...");
  pzem.setAddress(ip);

  // WiFi avec timeout
  WiFi.begin(ssid, password);
  Serial.print("Connexion WiFi");
  
  int tentatives = 0;
  while (WiFi.status() != WL_CONNECTED && tentatives < 20) {
    delay(500);
    Serial.print(".");
    tentatives++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi connecte!");
  } else {
    Serial.println("\nWiFi ECHEC - on continue sans WiFi");
  }

  // MQTT
  client.setServer(mqtt_server, 1883);
}

void reconnect() {
  // Tentative unique, pas de boucle bloquante
  if (client.connect("ESP32_Maquette")) {
    Serial.println("MQTT connecte!");
  } else {
    Serial.print("MQTT echec, rc=");
    Serial.println(client.state());
  }
}

void loop() {
  if (WiFi.status() == WL_CONNECTED) {
    if (!client.connected()) reconnect();
    client.loop();
  }

  float v  = pzem.voltage(ip);
  float i  = pzem.current(ip);
  float p  = pzem.power(ip);
  float e  = pzem.energy(ip);

  // Grandeurs calculées
  float S  = v * i;
  float Q  = sqrt(abs(S*S - p*p));
  float fp = (S > 0) ? (p / S) : 0;

  Serial.println("=== PZEM ===");

  if (v < 0) {
    Serial.println("Erreur lecture PZEM");
  } else {
    Serial.print("Tension          : "); Serial.print(v);   Serial.println(" V");
    Serial.print("Courant          : "); Serial.print(i);   Serial.println(" A");
    Serial.print("Puissance active : "); Serial.print(p);   Serial.println(" W");
    Serial.print("Puissance appar. : "); Serial.print(S);   Serial.println(" VA");
    Serial.print("Puissance react. : "); Serial.print(Q);   Serial.println(" VAR");
    Serial.print("Energie          : "); Serial.print(e);   Serial.println(" Wh");
    Serial.print("Cos phi / FP     : "); Serial.println(fp);

    if (WiFi.status() == WL_CONNECTED && client.connected()) {
      String payload = "{";
      payload += "\"tension\":"    + String(v, 2) + ",";
      payload += "\"courant\":"    + String(i, 3) + ",";
      payload += "\"puissanceact\":"  + String(p, 2) + ",";
      payload += "\"papparente\":"  + String(S, 2) + ",";
      payload += "\"preactive\":"   + String(Q, 2) + ",";
      payload += "\"energieact\":"    + String(e, 3) + ",";
      payload += "\"cos_phi\":"    + String(fp, 3);
      payload += "}";

      client.publish("maquette/pzem", payload.c_str());
      Serial.println("Publie MQTT → EMQX → Telegraf → InfluxDB");
    }
  }

  delay(5000);
}
