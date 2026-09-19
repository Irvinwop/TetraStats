import 'package:flutter_test/flutter_test.dart';
import 'package:tetra_stats/utils/internal_links.dart';

void main() {
  test('web-owned links stay on the local origin', () {
    final uri = tetraStatsUri(
      'oskware_bridge.php',
      queryParameters: const {
        'endpoint': 'tetrioUser',
        'user': 'Irvinwop',
      },
      useLocalOrigin: true,
      baseUri: Uri.parse('http://127.0.0.1:8080/u/Irvinwop'),
    );

    expect(
      uri.toString(),
      'http://127.0.0.1:8080/oskware_bridge.php?endpoint=tetrioUser&user=Irvinwop',
    );
  });

  test('native-owned links retain the upstream host', () {
    final uri = tetraStatsUri(
      'beanserver_blaster/cutoffs.json',
      useLocalOrigin: false,
    );

    expect(uri.host, tetraStatsUpstreamDomain);
    expect(uri.path, '/beanserver_blaster/cutoffs.json');
  });

  test('repository links target the personalized fork', () {
    expect(
      tetraStatsRepositoryUri('issues/new/choose').toString(),
      'https://github.com/Irvinwop/TetraStats/issues/new/choose',
    );
  });
}
