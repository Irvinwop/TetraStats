import 'package:flutter/foundation.dart';

const String tetraStatsUpstreamDomain = 'ts.dan63.by';
const String tetraStatsForkRepository = 'Irvinwop/TetraStats';

/// Resolves a TetraStats-owned endpoint.
///
/// Web builds keep these requests on the current origin so the local tracker
/// can serve or proxy them. Native builds continue to use the upstream host.
Uri tetraStatsUri(
  String path, {
  Map<String, String>? queryParameters,
  bool? useLocalOrigin,
  Uri? baseUri,
}) {
  final cleanPath = path.replaceFirst(RegExp(r'^/+'), '');
  if (useLocalOrigin ?? kIsWeb) {
    return (baseUri ?? Uri.base)
        .resolve('/$cleanPath')
        .replace(queryParameters: queryParameters);
  }
  return Uri.https(tetraStatsUpstreamDomain, cleanPath, queryParameters);
}

String tetraStatsUrl(
  String path, {
  Map<String, String>? queryParameters,
  bool? useLocalOrigin,
  Uri? baseUri,
}) =>
    tetraStatsUri(
      path,
      queryParameters: queryParameters,
      useLocalOrigin: useLocalOrigin,
      baseUri: baseUri,
    ).toString();

Uri tetraStatsRepositoryUri([String path = '']) {
  final cleanPath = path.replaceFirst(RegExp(r'^/+'), '');
  final suffix = cleanPath.isEmpty ? '' : '/$cleanPath';
  return Uri.https('github.com', '$tetraStatsForkRepository$suffix');
}
