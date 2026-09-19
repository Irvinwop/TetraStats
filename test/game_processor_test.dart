import 'package:flutter_test/flutter_test.dart';
import 'package:tetra_stats/data_objects/minomuncher.dart';
import 'package:tetra_stats/data_objects/tetrio_multiplayer_replay.dart';

void main() {
  test('aggregated Minomuncher results preserve the player id', () {
    final first = MinomuncherRaw(
      i: 'player-id',
      n: 'Irvinwop',
      p: MPlacement(pieces: 10, attack: 5),
    );
    final second = MinomuncherRaw(
      i: 'player-id',
      n: 'Irvinwop',
      p: MPlacement(pieces: 12, attack: 7),
    );

    final combined = first + second;

    expect(combined.id, 'player-id');
    expect(combined.nick, 'Irvinwop');
    expect(combined.placement.pieces, 22);
    expect(combined.placement.attack, 12);
  });

  test('garbage aggregation sums optional attack values', () {
    final first = Garbage(sent: 4, recived: 3, attack: 7, cleared: 2);
    final second = Garbage(sent: 5, recived: 6, attack: 11, cleared: 8);

    final combined = first + second;

    expect(combined.sent, 9);
    expect(combined.recived, 9);
    expect(combined.attack, 18);
    expect(combined.cleared, 10);
  });
}
