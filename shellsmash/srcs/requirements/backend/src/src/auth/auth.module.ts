import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
// import { FortyTwoStrategy } from './strategies/forty-two.strategy'; // TODO: uncomment when 42 OAuth keys are set
import { JwtStrategy } from './strategies/jwt.strategy';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    UsersModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        secret: config.get('JWT_SECRET'),
        signOptions: { expiresIn: config.get('JWT_EXPIRY', '3600s') },
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [AuthService, /* FortyTwoStrategy, */ JwtStrategy], // TODO: restore FortyTwoStrategy when 42 OAuth keys are set
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
