import path from 'path';
import { fileURLToPath } from 'url';
import nodeExternals from 'webpack-node-externals';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default {
  target: 'node',
  entry: './server.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'server.bundle.js',
    clean: true,
    // 输出ES模块格式，匹配项目的"type": "module"设置
    library: {
      type: 'module'
    }
  },
  // 配置webpack-node-externals使用ES模块格式
  externals: [nodeExternals({
    importType: 'module'
  })],
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: [
              ['@babel/preset-env', {
                // 不将ES模块转换为CommonJS
                modules: false
              }]
            ]
          }
        }
      }
    ]
  },
  resolve: {
    extensions: ['.js']
  },
  mode: 'production',
  // 启用ES模块支持
  experiments: {
    outputModule: true
  },
  // 禁用默认的模块转换，保持ES模块格式
  optimization: {
    minimize: true
  }
};
