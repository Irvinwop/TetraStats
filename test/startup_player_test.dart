import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:tetra_stats/main.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('personalized build seeds Irvinwop on first launch', () async {
    SharedPreferences.setMockInitialValues({});
    final preferences = await SharedPreferences.getInstance();

    await seedDefaultPlayerPreferences(preferences);

    expect(defaultPlayerUsername, 'Irvinwop');
    expect(defaultPlayerId, '678656e79f48dae00cefd822');
    expect(preferences.getString('player'), defaultPlayerUsername);
    expect(preferences.getString('playerID'), defaultPlayerId);
    expect(preferences.getBool('notFirstTime'), isTrue);
    expect(preferences.getString('statsPreference'), 'minomuncher');
  });

  test('personalized defaults do not replace user settings', () async {
    SharedPreferences.setMockInitialValues({
      'player': 'another-user',
      'playerID': 'another-id',
      'notFirstTime': false,
      'statsPreference': 'sheetbot',
    });
    final preferences = await SharedPreferences.getInstance();

    await seedDefaultPlayerPreferences(preferences);

    expect(preferences.getString('player'), 'another-user');
    expect(preferences.getString('playerID'), 'another-id');
    expect(preferences.getBool('notFirstTime'), isFalse);
    expect(preferences.getString('statsPreference'), 'sheetbot');
  });
}
